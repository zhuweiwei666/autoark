# Logs and Observability

The system includes built-in logging and monitoring mechanisms.

## Logging

- **Library**: Custom logger in `src/utils/logger.ts`.
- **Levels**: INFO, WARN, ERROR.
- **Features**:
    - **Request Logging**: Middleware logs every HTTP request (Method, URL, Status, Duration).
    - **Timer Logging**: `logger.timerLog` measures function execution time.
    - **Error Logging**: Captures stack traces for debugging.

## Database Logs

- **SyncLog**: Tracks the status and result of every data synchronization job.
- **OpsLog**: Records actions taken by the Rule Engine and AI Optimizer.

