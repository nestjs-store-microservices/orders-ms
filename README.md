# Orders Microservice

## Dev

1. Clone repository
2. Install dependencies
3. Create a new file `.env` base on `.env.template`
4. Execute migration prisma `npx prisma migrate dev`
5. Nats server up

```
docker run -d --name nats-main -p 4222:4222 -p 6222:6222 -p 8222:8222 nats
```

6. Execute `npm run start:dev`
