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
    ];
    var authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
  } catch (error) {
    console.error('Error occurred:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/callback', async (req, res) => {
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

      const playlist = await prisma.playlist.create({
        data: {},
      });

      const event = await prisma.event.create({
        data: {
          host: { connect: { id: updatedUser.id } },
          playlist: { connect: { id: playlist.id } },
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

module.exports = router;
