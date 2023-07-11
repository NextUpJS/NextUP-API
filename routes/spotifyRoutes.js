const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const {
  getSpotifyClient,
  spotifyApiContainer,
  getTokens,
  getUserData,
  createPlaylist,
} = require('../middleware/spotify'); // Assuming getSpotifyClient is in the spotifyApiContainer file

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

router.get('/callback', getTokens, getUserData, createPlaylist, (req, res) => {
  const userId = req.userId;
  return res.redirect(`https://nextup.rocks/hosts/${userId}`);
});

module.exports = router;
