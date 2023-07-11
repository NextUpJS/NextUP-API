const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();
const { getSpotifyClient, spotifyApiContainer } = require('../middleware/spotify');

router.get('/:name', async (req, res) => {
  const hostName = req.params.name;

  try {
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (host) {
      const events = await prisma.event.findMany({
        where: { hostId: host.id },
        include: {
          host: true,
          playlist: {
            include: {
              queue: {
                include: {
                  Track: {
                    include: {
                      Album: true,
                      Artist: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (events.length > 0) {
        res.json(events);
      } else {
        res.status(404).json({ error: 'No events found for this host' });
      }
    } else {
      res.status(404).json({ error: 'Host not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:name/pause', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.pause();

    console.log('Playback paused successfully');
    return res.send('Playback paused successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/now-playing', getSpotifyClient, async (req, res) => {
  try {
    const data = await req.spotifyClient.getMyCurrentPlaybackState();

    if (data.body && data.body.is_playing) {
      res.json(data.body);
    } else {
      res.json({ message: 'User is not playing anything, or playback is paused.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/resume', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.play();

    console.log('Playback resumed successfully');
    return res.send('Playback resumed successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/playlist', async (req, res) => {
  const hostName = req.params.name;

  const host = await prisma.user.findUnique({
    where: { name: hostName },
  });

  if (!host) {
    return res.status(404).json({ error: 'Host not found' });
  }

  const event = await prisma.event.findFirst({
    where: { hostId: host.id },
    include: { playlist: true },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found for this host' });
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: event.playlistId },
    include: { queue: true },
    include: { queue: { include: { Track: { include: { Album: true, Artist: true } } } } },
  });

  res.json({ playlist });
});

router.post('/:name/songs', getSpotifyClient, async (req, res) => {
  try {
    const { songID } = req.body;
    const hostName = req.params.name;

    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    const spotifyClient = req.spotifyClient;
    const trackData = await spotifyClient.getTrack(songID);

    if (!trackData.body) {
      return res.status(404).json({ error: 'Song not found in Spotify' });
    }

    const artistData = await spotifyClient.getArtist(trackData.body.artists[0].id);
    if (!artistData.body) {
      return res.status(404).json({ error: 'Artist not found in Spotify' });
    }

    const albumData = await spotifyClient.getAlbum(trackData.body.album.id);
    if (!albumData.body) {
      return res.status(404).json({ error: 'Album not found in Spotify' });
    }

    const artist = await prisma.artist.upsert({
      where: { id: artistData.body.id },
      update: {
        name: artistData.body.name,
        spotifyUrl: artistData.body.external_urls.spotify,
        href: artistData.body.href,
        artistType: artistData.body.type,
        uri: artistData.body.uri,
      },
      create: {
        id: artistData.body.id,
        name: artistData.body.name,
        spotifyUrl: artistData.body.external_urls.spotify,
        href: artistData.body.href,
        artistType: artistData.body.type,
        uri: artistData.body.uri,
      },
    });

    const album = await prisma.album.upsert({
      where: { id: albumData.body.id },
      update: {
        albumType: albumData.body.album_type,
        externalSpotifyUrl: albumData.body.external_urls.spotify,
        href: albumData.body.href,
        name: albumData.body.name,
        releaseDate: albumData.body.release_date,
        releaseDatePrecision: albumData.body.release_date_precision,
        totalTracks: albumData.body.total_tracks,
        uri: albumData.body.uri,
        artistId: artist.id,
      },
      create: {
        id: albumData.body.id,
        albumType: albumData.body.album_type,
        externalSpotifyUrl: albumData.body.external_urls.spotify,
        href: albumData.body.href,
        name: albumData.body.name,
        releaseDate: albumData.body.release_date,
        releaseDatePrecision: albumData.body.release_date_precision,
        totalTracks: albumData.body.total_tracks,
        uri: albumData.body.uri,
        artistId: artist.id,
      },
    });

    const track = await prisma.track.upsert({
      where: { id: trackData.body.id },
      update: {
        discNumber: trackData.body.disc_number,
        durationMs: trackData.body.duration_ms,
        explicit: trackData.body.explicit,
        isrc: trackData.body.external_ids.isrc,
        externalUrl: trackData.body.external_urls.spotify,
        href: trackData.body.href,
        isLocal: trackData.body.is_local,
        name: trackData.body.name,
        popularity: trackData.body.popularity,
        previewUrl: trackData.body.preview_url,
        trackNumber: trackData.body.track_number,
        trackType: trackData.body.type,
        uri: trackData.body.uri,
        artistId: artist.id,
        albumId: album.id,
      },
      create: {
        id: trackData.body.id,
        discNumber: trackData.body.disc_number,
        durationMs: trackData.body.duration_ms,
        explicit: trackData.body.explicit,
        isrc: trackData.body.external_ids.isrc,
        externalUrl: trackData.body.external_urls.spotify,
        href: trackData.body.href,
        isLocal: trackData.body.is_local,
        name: trackData.body.name,
        popularity: trackData.body.popularity,
        previewUrl: trackData.body.preview_url,
        trackNumber: trackData.body.track_number,
        trackType: trackData.body.type,
        uri: trackData.body.uri,
        artistId: artist.id,
        albumId: album.id,
      },
    });

    // const song = await prisma.song.create({
    //   data: {
    //     songId: track.id,
    //     playlistId: event.playlistId,
    //   },
    // });

    const queueItem = await prisma.queue.create({
      data: {
        position: (await prisma.queue.count()) + 1,
        playlistId: event.playlistId,
        trackId: track.id,
      },
    });

    console.log('event', event.playlist.spotify_id);

    // await spotifyClient.addTracksToPlaylist(event.playlist.spotify_id, [
    //   `spotify:track:${track.id}`,
    // ]);

    console.log('Song added successfully');
    return res.status(200).json({
      message: 'Song added successfully',
      queueItem: queueItem,
    });
  } catch (error) {
    console.error('An error occurred while adding the song:', error);
    return res.status(500).send('An error occurred while adding the song');
  }
});

// router.post('/:name/songs', getSpotifyClient, async (req, res) => {
//   try {
//     const { songID } = req.body;
//     const hostName = req.params.name;

//     const host = await prisma.user.findUnique({
//       where: { name: hostName },
//     });

//     if (!host) {
//       return res.status(404).json({ error: 'Host not found' });
//     }

//     const event = await prisma.event.findFirst({
//       where: { hostId: host.id },
//       include: { playlist: true },
//     });

//     if (!event) {
//       return res.status(404).json({ error: 'Event not found for this host' });
//     }

//     const playlist = await prisma.playlist.findUnique({
//       where: { id: event.playlistId },
//       include: { songs: true },
//     });

//     const song = await prisma.song.create({
//       data: {
//         songId: songID,
//         playlistId: playlist.id,
//       },
//     });

//     console.log('Song added successfully');
//     return res.status(200).json({ message: 'Song added successfully', song });
//   } catch (error) {
//     console.error('An error occurred while adding the song:', error);
//     return res.status(500).send('An error occurred while adding the song');
//   }
// });

router.get('/:name/tracks/:id', getSpotifyClient, async (req, res) => {
  const trackId = req.params.id;

  try {
    const data = await req.spotifyClient.getTrack(trackId);

    if (data.body) {
      res.json(data.body);
    } else {
      res.status(404).json({ message: 'Track not found.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

module.exports = router;
