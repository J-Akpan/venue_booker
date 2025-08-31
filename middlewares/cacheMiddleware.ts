// import Redis from "ioredis";

// const redis = new Redis();

// const cacheMiddleware = async (req, res, next) => {
//   const cached = await redis.get(req.originalUrl);
//   if (cached) return res.json(JSON.parse(cached));
//   next();
// };

// app.get("/api/data", cacheMiddleware, async (req, res) => {
//   const data = { message: "Fetched from DB/API" };
//   await redis.set(req.originalUrl, JSON.stringify(data), "EX", 60); // expire in 60s
//   res.json(data);
// });




// const cache = require("sequelize-redis-cache")({
//   client: redis,
//   prefix: "model:",
// });

// cache
//   .model(User)
//   .findAll()
//   .then(users => console.log(users));
