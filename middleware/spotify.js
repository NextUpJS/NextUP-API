const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SpotifyWebApi = require('spotify-web-api-node');

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

async function getSpotifyClient(req, res, next) {
  try {
    const hostName = req.params.name;

    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      console.error('Host not found');
      return res.status(404).send('Host not found');
    }

    let spotifyClient = spotifyApiContainer.getApiInstance(host.id);
    if (!spotifyClient) {
      spotifyApiContainer.createApiInstance(host.id, process.env.SPOTIFY_REDIRECT_URI);
      spotifyClient = spotifyApiContainer.getApiInstance(host.id);
    }

    const events = await prisma.event.findMany({
      where: { hostId: host.id },
      include: { host: true },
    });

    if (!events || events.length == 0) {
      console.error('No events found for this host');
      return res.status(404).send('No events found for this host');
    }

    // Check if the token has expired
    const now = new Date();
    if (now > new Date(host.spotify_token_expires_at)) {
      // If the token has expired, refresh it
      try {
        spotifyClient.setRefreshToken(host.spotify_refresh_token);
        const data = await spotifyClient.refreshAccessToken();
        const access_token = data.body['access_token'];

        // Save the new access token back to the database
        await prisma.user.update({
          where: { name: hostName },
          data: { spotify_token: access_token },
        });

        spotifyClient.setAccessToken(access_token);
      } catch (err) {
        console.error('Could not refresh access token', err);
        return res.status(500).send('Could not refresh access token');
      }
    } else {
      // If the token hasn't expired, continue with the existing token
      spotifyClient.setAccessToken(host.spotify_token);
    }

    req.spotifyClient = spotifyClient;
    next();
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
}

spotifyApiContainer.createApiInstance('login');
const spotifyApi = spotifyApiContainer.getApiInstance('login');

const getTokens = async (req, res, next) => {
  const { error, code } = req.query;
  if (error) {
    console.error('Callback Error:', error);
    return res.send(`Callback Error: ${error}`);
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    req.tokens = {
      access_token,
      refresh_token,
      expires_in,
    };
    next();
  } catch (err) {
    console.error('Error getting Tokens:', err);
    return res.send(`Error getting Tokens: ${err}`);
  }
};

const getUserData = async (req, res, next) => {
  try {
    const user = await spotifyApi.getMe();
    const userId = user.body.id;

    console.log('token ', req.tokens);
    const now = new Date();
    now.setSeconds(now.getSeconds() + 3500);

    const updatedUser = await prisma.user.upsert({
      where: { name: userId },
      update: {
        spotify_token: req.tokens.access_token,
        spotify_refresh_token: req.tokens.refresh_token,
        spotify_token_expires_at: now,
      },
      create: {
        name: userId,
        spotify_token: req.tokens.access_token,
        spotify_refresh_token: req.tokens.refresh_token,
        spotify_token_expires_at: now,
      },
    });

    req.userId = userId;
    req.updatedUser = updatedUser; // Ensure this line is included
    next();
  } catch (err) {
    console.error('Error getting user ID:', err);
    return res.send(`Error getting user ID: ${err}`);
  }
};

const createPlaylist = async (req, res, next) => {
  try {
    const userExists = await prisma.user.findUnique({
      where: { id: req.updatedUser.id },
    });

    if (!userExists) {
      return res.status(400).send(`User with id: ${req.updatedUser.id} does not exist`);
    }

    const existingEvent = await prisma.event.findFirst({
      where: { hostId: req.updatedUser.id },
      include: { playlist: true },
    });

    let playlistId;

    if (existingEvent && existingEvent.playlist) {
      // Event already has a playlist
      console.log(`Event already has a playlist: ${existingEvent.playlist.id}`);
      playlistId = existingEvent.playlist.id;
    } else {
      // Create a playlist
      const playlist = await prisma.playlist.create({
        data: {},
      });

      playlistId = playlist.id;

      if (existingEvent) {
        // Update event
        await prisma.event.update({
          where: { id: existingEvent.id },
          data: {
            playlistId: playlist.id,
          },
        });
      }
    }

    if (!existingEvent && playlistId) {
      // Create event
      console.log('host: ', req.updatedUser.id);
      console.log('playlist: ', playlistId);
      await prisma.event.create({
        data: {
          hostId: req.updatedUser.id,
          playlistId: playlistId,
          active: true, // or set this to the value you want
        },
      });
    }

    next();
  } catch (err) {
    console.error('Error creating playlist:', err);
    return res.send(`Error creating playlist: ${err}`);
  }
};

const getCurrentlyPlaying = async (req, res, next) => {
  try {
    const currentlyPlaying = await req.spotifyClient.getMyCurrentPlaybackState();

    if (!currentlyPlaying.body.is_playing) {
      req.currentlyPlaying = { error: 'No song is currently playing.' };
      return next();
    }

    req.currentlyPlaying = currentlyPlaying.body.item;
    next();
  } catch (err) {
    console.error('Error getting current song:', err);
    return res.status(500).json({ error: 'Error getting current song' });
  }
};

module.exports = {
  spotifyApiContainer,
  getSpotifyClient,
  createPlaylist,
  getUserData,
  getTokens,
  getCurrentlyPlaying,
};
