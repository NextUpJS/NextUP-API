const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();
const { getSpotifyClient, spotifyApiContainer } = require('../middleware/spotify');

router.get('/:id', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (!spotifyApiContainer.getApiInstance(eventId)) {
    spotifyApiContainer.createApiInstance(eventId);
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { host: true, playlist: { include: { songs: true } } },
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

router.get('/:id/pause', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.pause();

    console.log('Playback paused successfully');
    return res.send('Playback paused successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:id/now-playing', getSpotifyClient, async (req, res) => {
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

router.get('/:id/resume', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.play();

    console.log('Playback resumed successfully');
    return res.send('Playback resumed successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:id/playlist', async (req, res) => {
  const eventID = parseInt(req.params.id);
  const event = await prisma.event.findUnique({
    where: { id: eventID },
    include: { playlist: true },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: event.playlistId },
    include: { songs: true },
  });

  res.json({ playlist });
});

router.post('/:id/songs', getSpotifyClient, async (req, res) => {
  try {
    const { songID } = req.body;
    const eventID = parseInt(req.params.id);
    const event = await prisma.event.findUnique({
      where: { id: eventID },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: event.playlistId },
      include: { songs: true },
    });

    const song = await prisma.song.create({
      data: {
        playlistId: playlist.id,
      },
    });

    console.log('Song added successfully');
    return res.status(200).json({ message: 'Song added successfully', song });
  } catch (error) {
    console.error('An error occurred while adding the song:', error);
    return res.status(500).send('An error occurred while adding the song');
  }
});

module.exports = router;
