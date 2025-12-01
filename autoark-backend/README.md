# AutoArk Backend

Backend system for AutoArk, an automated advertising optimization platform.

## Tech Stack

- Node.js + TypeScript
- Express
- Mongoose (MongoDB Atlas)
- Axios (Facebook API)

## Project Structure

```
autoark-backend/
│── src/
│   ├── config/          # DB connection
│   ├── models/          # Mongoose Models
│   ├── services/        # External services (Facebook API)
│   ├── controllers/     # Route controllers
│   ├── routes/          # Express routes
│   ├── utils/           # Utilities
│   ├── app.ts           # App setup
│   └── server.ts        # Entry point
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Update `MONGO_URI` with your MongoDB connection string
   - Update `FB_ACCESS_TOKEN` with your Facebook Graph API token

3. Run in development mode:
   ```bash
   npm run dev
   ```

## API Endpoints

- `GET /facebook/accounts/:id/campaigns`
- `GET /facebook/accounts/:id/adsets`
- `GET /facebook/accounts/:id/ads`
- `GET /facebook/accounts/:id/insights/daily`

