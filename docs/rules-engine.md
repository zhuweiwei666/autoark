# Rules Engine

The Rule Engine allows for automated management of ad campaigns based on predefined conditions.

## Features

- **Trigger Conditions**: CPI, ROI, Spend, etc.
- **Actions**: Increase Budget, Decrease Budget, Pause Ad, Resume Ad.
- **Logging**: All automated actions are logged in `OpsLog`.

## Files

- `src/rules/ruleEngine.ts`: Core execution logic.
- `src/rules/ruleDefinitions.ts`: Definition of specific rules.
- `src/rules/actions.ts`: Implementation of actions (API calls).

