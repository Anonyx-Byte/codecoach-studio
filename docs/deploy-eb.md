# Elastic Beanstalk Minimum Environment Properties

In Elastic Beanstalk console, go to **Configuration -> Software -> Edit** and set:

- `AUTH_SECRET` = `<64-hex-string>`
- `CORS_ORIGIN` = `*`
- `AWS_REGION` = `<your-region>`
- `GROQ_API_KEY` = `<your_groq_key>` (plain text)

Generate `AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
