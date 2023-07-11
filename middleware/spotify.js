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
      spotifyApiContainer.createApiInstance(host.id);
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

    spotifyClient.setAccessToken(host.spotify_token);

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

    const updatedUser = await prisma.user.upsert({
      where: { name: userId },
      update: {
        spotify_token: req.tokens.access_token,
        spotify_refresh_token: req.tokens.refresh_token,
      },
      create: {
        name: userId,
        spotify_token: req.tokens.access_token,
        spotify_refresh_token: req.tokens.refresh_token,
      },
    });

    req.userId = userId;
    req.updatedUser = updatedUser;
    next();
  } catch (err) {
    console.error('Error getting user ID:', err);
    return res.send(`Error getting user ID: ${err}`);
  }
};

const createPlaylist = async (req, res, next) => {
  try {
    const data = await spotifyApi.createPlaylist(`NextUp - ${req.userId}`, {
      description: 'nextup.rocks',
      public: false,
    });

    let playListId = data.body['id'];

    const existingPlaylist = await prisma.playlist.findFirst({
      where: { name: playlistName },
    });

    const playlist = await prisma.playlist.create({
      data: { spotify_id: playListId },
    });

    const existingEvent = await prisma.event.findFirst({
      where: { hostId: req.updatedUser.id },
    });

    if (existingEvent) {
      // Update event
      await prisma.event.update({
        where: { id: existingEvent.id },
        data: {
          playlist: { connect: { id: playlist.id } },
        },
      });
    } else {
      // Create event
      await prisma.event.create({
        data: {
          host: { connect: { id: req.updatedUser.id } },
          playlist: { connect: { id: playlist.id } },
        },
      });
    }

    next();
  } catch (err) {
    console.error('Error creating playlist:', err);
    return res.send(`Error creating playlist: ${err}`);
  }
};

module.exports = { spotifyApiContainer, getSpotifyClient, createPlaylist, getUserData, getTokens };
