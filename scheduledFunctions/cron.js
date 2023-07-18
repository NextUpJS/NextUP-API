require('dotenv').config();
const CronJob = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({});
const SpotifyWebApi = require('spotify-web-api-node');

exports.initScheduledJobs = () => {
  const scheduledJobFunction = CronJob.schedule(process.env.CRON_TIME, async () => {
    const events = await prisma.event.findMany({
      include: {
        playlist: {
          include: {
            queue: {
              orderBy: {
                position: 'asc',
              },
            },
          },
        },
        host: true,
      },
    });

    const spotifyClient = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_SECRET_ID,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    });

    for (const event of events) {
      const now = new Date();
      const lastPlayed = new Date(event.last_queue_item_added);
      const differenceInMinutes = (now - lastPlayed) / 1000 / 60;

      if (differenceInMinutes > 60) {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            active: false,
          },
        });
        console.log(
          `Event ${event.id} has been inactive for more than 60 minutes. Set active to false.`,
        );
        continue;
      }

      spotifyClient.setAccessToken(event.host.spotify_token);

      const playbackState = await spotifyClient.getMyCurrentPlaybackState();
      const track = playbackState.body.item;

      if (track) {
        try {
          const currentEvent = await prisma.event.findUnique({ where: { id: event.id } });

          let trackInDb = await prisma.track.findUnique({ where: { id: track.id } });
          let artistInDb = await prisma.artist.findUnique({ where: { id: track.artists[0].id } });
          let albumInDb = await prisma.album.findUnique({ where: { id: track.album.id } });

          if (!artistInDb && track.artists[0]) {
            artistInDb = await prisma.artist.create({
              data: {
                id: track.artists[0].id,
                name: track.artists[0].name,
                href: track.artists[0].href,
                spotifyUrl: track.artists[0].external_urls.spotify,
                uri: track.artists[0].uri,
                artistType: track.artists[0].type,
              },
            });
            console.log(`Added artist '${artistInDb.name}' to the database.`);
          }

          if (!albumInDb) {
            albumInDb = await prisma.album.create({
              data: {
                id: track.album.id,
                albumType: track.album.album_type,
                externalSpotifyUrl: track.album.external_urls.spotify,
                href: track.album.href,
                name: track.album.name,
                releaseDate: track.album.release_date,
                releaseDatePrecision: track.album.release_date_precision,
                totalTracks: track.album.total_tracks,
                uri: track.album.uri,

                Artist: {
                  connect: { id: track.artists[0].id },
                },
              },
            });
            console.log(`Added album '${albumInDb.name}' to the database.`);
          }

          if (!trackInDb) {
            trackInDb = await prisma.track.create({
              data: {
                id: track.id,
                name: track.name,
                discNumber: track.disc_number,
                durationMs: track.duration_ms,
                explicit: track.explicit,
                isrc: track.external_ids.isrc,
                externalUrl: track.external_urls.spotify,
                href: track.href,
                isLocal: track.is_local,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                trackNumber: track.track_number,
                trackType: track.type,
                uri: track.uri,
                albumId: track.album.id,
                artistId: track.artists[0].id,
              },
            });
            console.log(`Added track '${trackInDb.name}' to the database.`);
          }

          if (currentEvent.playingTrackId !== track.id) {
            await prisma.event.update({
              where: { id: event.id },
              data: {
                playingTrackId: track.id,
              },
            });
            console.log(`Updated playingTrackId to '${track.id}' for event: ${event.id}`);
          }
        } catch (error) {
          console.error('Error occurred:', error);
        }
      }

      if (!track) {
        console.log(`There's no currently playing track for event: ${event.id}`);
      } else if (
        playbackState.body.progress_ms >= track.duration_ms ||
        playbackState.body.progress_ms === 0
      ) {
        console.log(`The track '${track.name}' has ended for event: ${event.id}`);

        const validQueueItems = event.playlist.queue.filter((item) => item.position >= 0);
        if (validQueueItems.length > 0) {
          const nextSong = validQueueItems[0];
          console.log(nextSong);
          await spotifyClient.play({ uris: [`spotify:track:${nextSong.trackId}`] });

          const transaction = await prisma.$transaction(
            validQueueItems.map((item) =>
              prisma.queue.update({
                where: { id: item.id },
                data: { position: item.position > 0 ? item.position - 1 : 0 },
              }),
            ),
          );

          console.log(validQueueItems);

          console.log(`Played next song and updated queue positions.`);
        } else {
          console.log(`The queue is empty, no song to play.`);

          const recommendations = await spotifyClient.getRecommendations({
            seed_tracks: [track.id],
            min_energy: 0.4,
            min_popularity: 50,
            limit: 20,
          });

          if (recommendations.body.tracks.length > 0) {
            const randomIndex = Math.floor(Math.random() * recommendations.body.tracks.length);
            const randomTrack = recommendations.body.tracks[randomIndex];

            const lastRandomSongAttempt = new Date(event.last_random_song_attempt);
            const now = new Date();

            if (now.getTime() - lastRandomSongAttempt.getTime() >= 5000) {
              await spotifyClient.play({ uris: [`spotify:track:${randomTrack.id}`] });
              console.log(
                `Played a random recommended song: '${randomTrack.name}' by '${randomTrack.artists[0].name}'`,
              );

              await prisma.event.update({
                where: { id: event.id },
                data: { last_random_song_attempt: now },
              });
            } else {
              console.log(
                `Less than 5 seconds have passed since the last attempt. Not playing a new song.`,
              );
            }
          } else {
            console.log(`No recommended tracks found.`);
          }
        }
      } else {
        console.log(`The track '${track.name}' is still playing for event: ${event.id}`);
      }
    }
  });

  scheduledJobFunction.start();
};
