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

module.exports = { spotifyApiContainer, getSpotifyClient };
