const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getSpotifyClient, spotifyApiContainer } = require('../middleware/spotify'); // Assuming getSpotifyClient is in the spotifyApiContainer file

const router = express.Router();

spotifyApiContainer.createApiInstance('login');
const spotifyApi = spotifyApiContainer.getApiInstance('login');

router.get('/login', function (req, res) {
  try {
    var scopes = [
      'user-read-private',
      'user-read-email',
      'user-modify-playback-state',
      'user-read-playback-state',
      'playlist-modify-public',
      'playlist-modify-private',
    ];
    var authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
  } catch (error) {
    console.error('Error occurred:', error);
    res.status(500).send('Internal Server Error');
  }
});

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

    const playlist = await prisma.playlist.create({
      data: { spotify_id: playListId },
    });
    const event = await prisma.event.create({
      data: {
        host: { connect: { id: req.updatedUser.id } },
        playlist: { connect: { id: playlist.id } },
      },
    });

    next();
  } catch (err) {
    console.error('Error creating playlist:', err);
    return res.send(`Error creating playlist: ${err}`);
  }
};

router.get('/callback', getTokens, getUserData, createPlaylist, (req, res) => {
  return res.redirect('/users');
});

module.exports = router;
