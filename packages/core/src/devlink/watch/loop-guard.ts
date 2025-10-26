import { EventEmitter } from "node:events";
import { logger } from "../../utils/logger";

export interface LoopGuardState {
  package: string;
  buildsInWindow: number[]; // timestamps
  windowMs: number; // 10000
  threshold: number; // 3
  cooldownMs: number; // текущий cooldown (5/10/20/40/60 cap)
  cooldownUntil?: number;
  degradedHashingUntil?: number;
  lastSuccessfulBuild?: number;
  loopGuardActivations: number[]; // timestamps активаций за последние 2 мин
}

/**
 * Защита от циклов с адаптивным backoff и degraded hashing
 */
export class LoopGuard extends EventEmitter {
  private states = new Map<string, LoopGuardState>();
  private globalCooldownThreshold = 5; // пакетов одновременно
  private globalCooldownMs = 3000;
  private globalCooldownUntil?: number;
  
  constructor() {
    super();
  }
  
  /**
   * Регистрация билда
   */
  recordBuild(pkg: string): { allowed: boolean; cooldownMs?: number; reason?: string } {
    const now = Date.now();
    
    // Проверка глобального рубильника
    if (this.globalCooldownUntil && this.globalCooldownUntil > now) {
      return {
        allowed: false,
        reason: 'global_cooldown',
        cooldownMs: this.globalCooldownUntil - now
      };
    }
    
    // Проверка глобального порога
    const activeCooldowns = Array.from(this.states.values())
      .filter(s => s.cooldownUntil && s.cooldownUntil > now);
    
    if (activeCooldowns.length >= this.globalCooldownThreshold) {
      this.globalCooldownUntil = now + this.globalCooldownMs;
      this.emit({
        kind: 'devlink.loopguard.global',
        timestamp: new Date().toISOString(),
        schemaVersion: '1.0',
        activeCooldowns: activeCooldowns.length,
        cooldownMs: this.globalCooldownMs
      });
      
      return {
        allowed: false,
        reason: 'global_cooldown',
        cooldownMs: this.globalCooldownMs
      };
    }
    
    // Получаем или создаем состояние для пакета
    let state = this.states.get(pkg);
    if (!state) {
      state = {
        package: pkg,
        buildsInWindow: [],
        windowMs: 10000,
        threshold: 3,
        cooldownMs: 5000, // начальный cooldown
        loopGuardActivations: []
      };
      this.states.set(pkg, state);
    }
    
    // Проверяем cooldown
    if (state.cooldownUntil && state.cooldownUntil > now) {
      return {
        allowed: false,
        reason: 'cooldown',
        cooldownMs: state.cooldownUntil - now
      };
    }
    
    // Добавляем билд в окно
    state.buildsInWindow.push(now);
    
    // Очищаем старые билды из окна
    const windowStart = now - state.windowMs;
    state.buildsInWindow = state.buildsInWindow.filter(t => t > windowStart);
    
    // Проверяем порог
    if (state.buildsInWindow.length >= state.threshold) {
      // Активируем loop guard
      state.loopGuardActivations.push(now);
      state.cooldownUntil = now + state.cooldownMs;
      
      // Адаптивный backoff
      state.cooldownMs = this.calculateBackoff(state);
      
      // Degraded hashing после 2-го срабатывания за 2 мин
      const twoMinutesAgo = now - 120000;
      const recentActivations = state.loopGuardActivations.filter(t => t > twoMinutesAgo);
      
      if (recentActivations.length >= 2) {
        state.degradedHashingUntil = now + 60000; // 60 секунд
        this.emit({
          kind: 'devlink.degraded.hashing',
          timestamp: new Date().toISOString(),
          schemaVersion: '1.0',
          package: pkg,
          enabled: true,
          reason: 'loop_guard_activation'
        });
      }
      
      this.emit({
        kind: 'devlink.loopguard.cooldown',
        timestamp: new Date().toISOString(),
        schemaVersion: '1.0',
        package: pkg,
        windowMs: state.windowMs,
        cooldownMs: state.cooldownMs,
        buildsInWindow: state.buildsInWindow.length
      });
      
      logger.warn("Loop guard activated", {
        package: pkg,
        buildsInWindow: state.buildsInWindow.length,
        cooldownMs: state.cooldownMs,
        degradedHashing: !!state.degradedHashingUntil
      });
      
      return {
        allowed: false,
        reason: 'loop_guard',
        cooldownMs: state.cooldownMs
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Успешный билд — сброс backoff
   */
  recordSuccess(pkg: string): void {
    const state = this.states.get(pkg);
    if (!state) return;
    
    const now = Date.now();
    state.lastSuccessfulBuild = now;
    
    // Сброс cooldown при успешном билде
    if (state.cooldownUntil && state.cooldownUntil <= now) {
      state.cooldownUntil = undefined;
      state.cooldownMs = 5000; // сброс к начальному значению
      
      logger.debug("Loop guard cooldown cleared by successful build", {
        package: pkg
      });
    }
  }
  
  /**
   * Проверка, можно ли собирать
   */
  canBuild(pkg: string): boolean {
    const state = this.states.get(pkg);
    if (!state) return true;
    
    const now = Date.now();
    
    // Проверяем cooldown
    if (state.cooldownUntil && state.cooldownUntil > now) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Активация degraded hashing (после 2-го срабатывания за 2 мин, на 60 сек)
   */
  shouldUseDegradedHashing(pkg: string): boolean {
    const state = this.states.get(pkg);
    if (!state) return false;
    
    const now = Date.now();
    return !!(state.degradedHashingUntil && state.degradedHashingUntil > now);
  }
  
  /**
   * Адаптивный backoff: 5 → 10 → 20 → 40 → 60 (cap)
   */
  private calculateBackoff(state: LoopGuardState): number {
    const activations = state.loopGuardActivations.length;
    const backoffLevels = [5000, 10000, 20000, 40000, 60000];
    const level = Math.min(activations - 1, backoffLevels.length - 1);
    return backoffLevels[level];
  }
  
  /**
   * Ручной override
   */
  forceAllow(pkg: string): void {
    const state = this.states.get(pkg);
    if (!state) return;
    
    state.cooldownUntil = undefined;
    state.cooldownMs = 5000; // сброс к начальному значению
    
    this.emit({
      kind: 'devlink.loopguard.manual_override',
      timestamp: new Date().toISOString(),
      schemaVersion: '1.0',
      package: pkg,
      reason: 'manual override'
    });
    
    logger.info("Loop guard manually overridden", { package: pkg });
  }
  
  /**
   * Сброс состояния
   */
  reset(pkg: string): void {
    this.states.delete(pkg);
    logger.debug("Loop guard state reset", { package: pkg });
  }
  
  /**
   * Получить статистику
   */
  getStats(): {
    totalPackages: number;
    activeCooldowns: number;
    degradedHashing: string[];
    globalCooldown?: number;
  } {
    const now = Date.now();
    const activeCooldowns = Array.from(this.states.values())
      .filter(s => s.cooldownUntil && s.cooldownUntil > now);
    
    const degradedHashing = Array.from(this.states.entries())
      .filter(([, s]) => s.degradedHashingUntil && s.degradedHashingUntil > now)
      .map(([pkg]) => pkg);
    
    return {
      totalPackages: this.states.size,
      activeCooldowns: activeCooldowns.length,
      degradedHashing,
      globalCooldown: this.globalCooldownUntil && this.globalCooldownUntil > now 
        ? this.globalCooldownUntil - now 
        : undefined
    };
  }
}
