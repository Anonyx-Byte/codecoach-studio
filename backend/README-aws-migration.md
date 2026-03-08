# Backend AWS Migration notes

Prereqs:
- Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or use IAM role on EC2)
- Ensure DynamoDB tables Users, Analytics, Sessions exist (on-demand billing)
- Optionally set REDIS_URL for rate limiting and caching

Local commands:
- npm ci
- node index.js    # starts server (validates tables)
- node scripts/migrate-to-dynamo.js    # run migration (creates backup)

Notes:
- /api/health checks DynamoDB and Redis.
- Analytics: each attempt writes to Analytics table; Users table has a small analyticsSummary for quick lookups.
