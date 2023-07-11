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

module.exports = { spotifyApiContainer, getSpotifyClient };
