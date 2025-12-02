export interface SchemaReference {
  ref: string;
  format?: 'json-schema' | 'zod' | 'ts' | 'openapi';
}

export interface RestRouteContract {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
  request?: SchemaReference;
  response?: SchemaReference;
  produces?: string[];
}

export interface RestApiContract {
  basePath: string;
  routes: Record<string, RestRouteContract>;
}

export interface ApiContract {
  rest?: RestApiContract;
}

