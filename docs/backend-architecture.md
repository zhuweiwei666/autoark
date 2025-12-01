# Backend Architecture

The backend is built with a layered architecture to ensure separation of concerns and maintainability.

## Structure

- **Controllers**: Handle HTTP requests and responses.
- **Services**: Contain business logic and external API integrations.
- **Models**: Mongoose schemas for data persistence.
- **Routes**: API route definitions.
- **Cron**: Scheduled tasks for data synchronization and rule execution.
- **Rules**: Rule engine definitions and execution logic.
- **AI**: AI analyzer and recommender modules.

## Technology Stack

- Node.js
- Express
- TypeScript
- Mongoose
- Axios
- Node-cron

