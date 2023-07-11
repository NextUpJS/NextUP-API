require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');
const eventRoutes = require('./routes/eventRoutes');
const spotifyRoutes = require('./routes/spotifyRoutes');
const scheduledFunctions = require('./scheduledFunctions/cron');

const app = express();
const morgan = require('morgan');

app.use(express.json());
app.use(morgan('combined'));

const allowedOrigins = ['https://nextup.rocks'];

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  }),
);

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/users', userRoutes);
app.use('/events', eventRoutes);
app.use('/', spotifyRoutes);

app.set('etag', false);

scheduledFunctions.initScheduledJobs();

app.listen(process.env.APP_PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.APP_PORT}`);
});
