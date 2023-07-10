require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const SpotifyWebApi = require('spotify-web-api-node');
const cors = require('cors');

const prisma = new PrismaClient();
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

app.set('etag', false);

const spotifyApiContainer = {
  spotifyApis: {},

  createApiInstance(name, redirectUri) {
    this.spotifyApis[name] = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_SECRET_ID,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    });
  },

  getApiInstance(name) {
    return this.spotifyApis[name];
  },
};

spotifyApiContainer.createApiInstance('login');
const spotifyApi = spotifyApiContainer.getApiInstance('login');

async function getSpotifyClient(req, res, next) {
  try {
    const eventId = parseInt(req.params.id);

    let spotifyClient = spotifyApiContainer.getApiInstance(eventId);
    if (!spotifyClient) {
      spotifyApiContainer.createApiInstance(eventId);
      spotifyClient = spotifyApiContainer.getApiInstance(eventId);
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { host: true },
    });

    if (!event || !event.host) {
      console.error('Event or host not found');
      return res.status(404).send('Event or host not found');
    }

    spotifyClient.setAccessToken(event.host.spotify_token);

    req.spotifyClient = spotifyClient;
    next();
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
}

app.get('/events/:id/songs', async (req, res) => {
  const eventID = req.params.id;
  if (!spotifyApiContainer.getApiInstance(eventID)) {
    spotifyApiContainer.createApiInstance(eventID);
  }
  const songs = await prisma.song.findMany();
  res.json(songs);
});

app.post('/events/:id/songs', async (req, res) => {
  const eventID = req.params.id;
  if (!spotifyApiContainer.getApiInstance(eventID)) {
    spotifyApiContainer.createApiInstance(eventID);
  }

  try {
    const { id } = req.params;
    const { playlistId } = req.body;

    const playlist = await prisma.playlist.findUnique({
      where: { id: parseInt(id) },
    });

    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    const song = await prisma.song.create({
      data: {
        playlistId: parseInt(id),
      },
    });

    res.status(200).json({ message: 'Song added successfully', song });
  } catch (error) {
    console.error('Error adding song:', error);
    res.status(500).json({ message: 'An error occurred while adding the song' });
  }
});

app.get('/users', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

app.get('/events/:id', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (!spotifyApiContainer.getApiInstance(eventId)) {
    spotifyApiContainer.createApiInstance(eventId);
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { host: true },
    });

    if (event) {
      res.json(event);
    } else {
      res.status(404).json({ error: 'Event not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/events', async (req, res) => {
  const { hostId, hostToken } = req.body;

  try {
    const event = await prisma.event.create({
      data: {
        host: { connect: { id: hostId } },
        host_token: hostToken,
      },
    });

    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/events/:id/pause', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.pause();

    console.log('Playback paused successfully');
    return res.send('Playback paused successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

app.get('/events/:id/now-playing', getSpotifyClient, async (req, res) => {
  try {
    const data = await req.spotifyClient.getMyCurrentPlaybackState();

    if (data.body && data.body.is_playing) {
      res.json(data.body.item);
    } else {
      res.json({ message: 'User is not playing anything, or playback is paused.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

app.get('/events/:id/resume', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.play();

    console.log('Playback resumed successfully');
    return res.send('Playback resumed successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

app.get('/login', function (req, res) {
  try {
    var scopes = [
      'user-read-private',
      'user-read-email',
      'user-modify-playback-state',
      'user-read-playback-state',
    ];
    var authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
  } catch (error) {
    console.error('Error occurred:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/callback', async (req, res) => {
  const { error, code, state } = req.query;

  if (error) {
    console.error('Callback Error:', error);
    return res.send(`Callback Error: ${error}`);
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    console.log('access_token:', access_token);
    console.log('refresh_token:', refresh_token);
    console.log(`Successfully retrieved access token. Expires in ${expires_in} s.`);

    try {
      const user = await spotifyApi.getMe();
      const userId = user.body.id;

      const updatedUser = await prisma.user.upsert({
        where: { name: userId },
        update: {
          spotify_token: access_token,
          spotify_refresh_token: refresh_token,
        },
        create: {
          name: userId,
          spotify_token: access_token,
          spotify_refresh_token: refresh_token,
        },
      });

      console.log('updated user: ', updatedUser);

      const event = await prisma.event.create({
        data: {
          host: { connect: { id: updatedUser.id } },
        },
      });

      console.log('User ID:', userId);
      return res.redirect('/users');
    } catch (err) {
      console.error('Error getting user ID:', err);
      return res.send(`Error getting user ID: ${err}`);
    }
  } catch (err) {
    console.error('Error getting Tokens:', err);
    return res.send(`Error getting Tokens: ${err}`);
  }
});

app.listen(process.env.APP_PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.APP_PORT}`);
});
