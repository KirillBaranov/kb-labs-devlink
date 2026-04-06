## [1.1.0] - 2026-04-06

> **@kb-labs/devlink** 1.0.0 → 1.1.0 (minor: new features)

### ✨ New Features

- **general**: Users can now retain up to 10 backups, ensuring better data safety and recovery options, with the option for automatic backups and increased timeouts for improved reliability.
- **general**: DevLink v2 introduces full cross-repo dependency management, making it easier for users to manage dependencies across multiple repositories seamlessly.
- **devlink**: The rewrite from v2 to v3 of the plugin architecture allows for a more robust and flexible system, enhancing user experience and plugin performance.
- **devlink-adapters**: A new utility, resolveWorkspaceRoot, simplifies workspace management, making it easier for users to navigate their projects.
- **devlink-contracts**: The addition of the sha1 utility function helps users ensure data integrity, improving the security of their operations.
- **devlink-contracts**: Introducing DevLinkEventEmitter and event types allows users to better manage events in their applications, enhancing interactivity and responsiveness.
- **devlink**: The creation of devlink-cli and devlink-adapters packages streamlines the user experience by providing organized tools for command-line and adapter functionalities.
- **devlink**: A new module structure for devlink improves organization and usability, making it easier for users to find and utilize the necessary components.
- **architecture**: A new domain-driven architecture enhances system stability and scalability, ensuring a better experience for users as the software grows.
- **docs**: Standardizing the ADR format with metadata helps users quickly understand key decisions and changes in the software, improving clarity and communication.
- **analytics**: Users can now benefit from analytics in commands like watch, clean, and backups, providing insights into usage and performance for better decision-making.
- **analytics**: Additional analytics added to freeze, undo, switch, and update commands offer users more visibility into their actions and outcomes, enhancing their workflow.
- **analytics**: The inclusion of analytics in plan, apply, and status commands helps users track their progress and efficiency, leading to better management of their tasks.
- **general**: Integration of an analytics SDK empowers users with more data-driven insights into their software usage, aiding in informed decision-making.
- **devlink**: Fixing the hanging issue in watch --dry-run enhances user experience by ensuring smooth operation without unexpected stops.
- **devlink**: The new --dry-run flag for the update command allows users to preview changes before applying them, reducing the risk of unintended modifications.
- **back

### 🐛 Bug Fixes

- **general**: Enhances the workspace-yaml generation and synchronizes devlink paths, ensuring a smoother setup process for users.
- **general**: Cleans up unnecessary files in node_modules and allows installation even when dependencies remain unchanged, improving overall performance and efficiency.
- **general**: Expands the installation command to also cover repositories that lack a lockfile, making it easier for users to manage their projects.
- **devlink-cli**: Replaces the old scanAndPlan function with scanPackages and buildPlan, streamlining the scanning process for improved usability.
- **devlink**: Introduces command entry points and subpath exports, allowing users to access functionality more intuitively.
- **devlink**: Fixes issues with CLI manifest export and registration, ensuring a smoother experience when using the command line interface.
- **general**: Updates the devlink-contracts dependency path after a rename, preventing potential disruptions for users relying on these contracts.
- **manifest**: Adds a generic type parameter for Level 2 typing, enhancing type safety and clarity in project configurations.
- **docs**: Updates the Last Updated date to November 2025, providing users with accurate information about documentation recency.
- **devlink**: Freezes the current mode and manifest versions, ensuring consistency and stability for users during updates.
- **undo**: Restores all files from backup.json instead of just manifestPatches, giving users full recovery options in case of errors.
- **flags**: Correctly reads the dry-run flag from the flags object, improving the reliability of commands that rely on this functionality.
- **apply**: Utilizes action.to instead of looking up the version for use-npm, simplifying the process and reducing potential errors.
- **scan**: Replaces broad type definitions with the specific PackageJson type, enhancing accuracy and reducing confusion for users.
- **preflight**: Filters out node_modules files from the git dirty check, helping users to focus on relevant changes only.
- **status**: Simplifies command discovery for suggestions, making it easier for users to find the commands they need.
- **eslint**: Resolves critical linting errors and improves overall code quality, leading to a more stable and reliable software experience for users.
- **devlink**: Fixes the timing for artifacts display and plan saving, ensuring users have timely access to their data.
- **watch**: Corrects chokidar configuration for file watching, enhancing
