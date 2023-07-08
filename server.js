const express = require('express');
const { PrismaClient } = require('@prisma/client');
const SpotifyWebApi = require('spotify-web-api-node');

const prisma = new PrismaClient();
const app = express();
const morgan = require('morgan');
app.use(express.json());
app.use(morgan('combined'));

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
    const { id } = req.params; // Extract the 'id' from the request parameters
    const { playlistId } = req.body; // Assuming the playlist ID is sent in the request body

    // Find the playlist based on the provided 'id'
    const playlist = await prisma.playlist.findUnique({
      where: { id: parseInt(id) },
    });

    // If the playlist doesn't exist, return an error
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    // Create a new song and associate it with the playlist
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

app.post('/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Invalid request. name and email are required.' });
    }

    const user = await prisma.user.create({
      data: {
        name,
      },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/events/:id', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (!spotifyApiContainer.getApiInstance(eventID)) {
    spotifyApiContainer.createApiInstance(eventID);
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { host: true }, // Include the related host information
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

app.get('/events/:id/pause', function (req, res) {
  const eventId = parseInt(req.params.id);
  if (!spotifyApiContainer.getApiInstance(eventID)) {
    spotifyApiContainer.createApiInstance(eventID);
  }

  spotifyApi
    .pause()
    .then(() => {
      console.log('Playback paused successfully');
      res.send('Paused');
    })
    .catch((err) => {
      console.error('Something went wrong!', err);
    });
});

app.get('/events/:id/now-playing', (req, res) => {
  const eventId = parseInt(req.params.id);
  if (!spotifyApiContainer.getApiInstance(eventID)) {
    spotifyApiContainer.createApiInstance(eventID);
  }

  spotifyApi
    .getMyCurrentPlaybackState()
    .then((data) => {
      if (data.body && data.body.is_playing) {
        res.json(data.body.item); // Return the full song object as JSON
      } else {
        res.json({ message: 'User is not playing anything, or playback is paused.' });
      }
    })
    .catch((err) => {
      console.error('Something went wrong!', err);
      res.status(500).json({ message: 'Internal Server Error' }); // Internal Server Error
    });
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
    // Handle the error here
    console.error('Error occurred:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/callback', function (req, res) {
  const error = req.query.error;
  const code = req.query.code;
  const state = req.query.state;

  if (error) {
    console.error('Callback Error:', error);
    res.send(`Callback Error: ${error}`);
    return;
  }

  spotifyApi.authorizationCodeGrant(code).then(
    function (data) {
      const access_token = data.body['access_token'];
      const refresh_token = data.body['refresh_token'];
      const expires_in = data.body['expires_in'];

      spotifyApi.setAccessToken(access_token);
      spotifyApi.setRefreshToken(refresh_token);

      console.log('access_token:', access_token);
      console.log('refresh_token:', refresh_token);

      console.log(`Successfully retrieved access token. Expires in ${expires_in} s.`);
      res.send('Success! You can now close the window.');
    },
    function (err) {
      console.error('Error getting Tokens:', err);
      res.send(`Error getting Tokens: ${err}`);
    },
  );
});

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
