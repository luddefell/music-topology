package com.soundscapemap.api.worker;

import com.soundscapemap.api.model.VoteInput;
import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.service.SpotifyService;
import com.soundscapemap.api.ws.RegionUpdateHub;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

@Component
public class SpotifyPoller {
  private final Map<String, Listener> listeners = new ConcurrentHashMap<>();
  private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
  private final SpotifyService spotify;
  private final SoundscapeRepository repository;
  private final RegionUpdateHub hub;
  private boolean started;

  public SpotifyPoller(SpotifyService spotify, SoundscapeRepository repository, RegionUpdateHub hub) {
    this.spotify = spotify;
    this.repository = repository;
    this.hub = hub;
  }

  public void start() {
    if (started) return;
    started = true;
    scheduler.scheduleAtFixedRate(this::tick, 5, 5, TimeUnit.SECONDS);
  }

  public void add(String userId, String regionId, String regionType) {
    Listener previous = listeners.get(userId);
    boolean targetChanged = previous != null && (!previous.regionId().equals(regionId) || !previous.regionType().equals(regionType));
    Listener next = new Listener(
        userId,
        regionId,
        regionType,
        targetChanged ? null : previous == null ? null : previous.lastTrackId(),
        previous == null ? null : previous.lastTrackName(),
        null,
        previous == null ? 0 : previous.pollCount(),
        previous == null ? 0 : previous.voteCount(),
        "idle",
        null,
        null
    );
    listeners.put(userId, next);
    poll(next);
  }

  public void remove(String userId) {
    listeners.remove(userId);
  }

  public Map<String, Object> status(String userId) {
    Listener listener = listeners.get(userId);
    if (listener == null) return Map.of("status", "off");
    return new java.util.LinkedHashMap<>(Map.ofEntries(
        Map.entry("status", "listening"),
        Map.entry("region_id", listener.regionId()),
        Map.entry("region_type", listener.regionType()),
        Map.entry("poll_count", listener.pollCount()),
        Map.entry("vote_count", listener.voteCount()),
        Map.entry("last_status", listener.lastStatus() == null ? "idle" : listener.lastStatus()),
        Map.entry("last_polled_at", listener.lastPolledAt() == null ? "" : listener.lastPolledAt().toString()),
        Map.entry("last_vote_at", listener.lastVoteAt() == null ? "" : listener.lastVoteAt().toString()),
        Map.entry("last_track_id", listener.lastTrackId() == null ? "" : listener.lastTrackId()),
        Map.entry("last_track_name", listener.lastTrackName() == null ? "" : listener.lastTrackName()),
        Map.entry("last_error", listener.lastError() == null ? "" : listener.lastError())
    ));
  }

  private void tick() {
    Instant now = Instant.now();
    for (Listener listener : listeners.values()) {
      if ("unauthorized".equals(listener.lastStatus())) continue;
      if (listener.lastPolledAt() != null && listener.lastPolledAt().plusSeconds(10).isAfter(now)) continue;
      poll(listener);
    }
  }

  private void poll(Listener listener) {
    Listener current = listener.withPoll("polling", null);
    listeners.put(listener.userId(), current);
    try {
      SoundscapeRepository.StoredToken token = spotify.validTokenForUser(listener.userId());
      if (token == null) {
        listeners.put(listener.userId(), current.withStatus("unauthorized", "Spotify authorization expired. Connect Spotify again."));
        return;
      }
      SpotifyService.CurrentTrack track = spotify.currentlyPlaying(token.accessToken());
      if (track == null) {
        listeners.put(listener.userId(), current.withStatus("no_playback", null));
        return;
      }
      if (track.id().equals(listener.lastTrackId())) {
        listeners.put(listener.userId(), current.withTrack(track.id(), track.name()).withStatus("same_track", null));
        return;
      }
      repository.insertVote(new VoteInput(
          listener.userId(),
          listener.regionId(),
          listener.regionType(),
          listener.regionId(),
          track.id(),
          track.name(),
          track.artist(),
          track.albumArt(),
          track.genre(),
          track.genreLabel(),
          0.6,
          "listening"
      ));
      var snapshot = repository.computeSnapshot(listener.regionId(), listener.regionType());
      hub.publish(snapshot);
      listeners.put(listener.userId(), current.withTrack(track.id(), track.name()).withVote("voted"));
    } catch (Exception error) {
      listeners.put(listener.userId(), current.withStatus("error", error.getMessage()));
    }
  }

  private record Listener(
      String userId,
      String regionId,
      String regionType,
      String lastTrackId,
      String lastTrackName,
      Instant lastPolledAt,
      int pollCount,
      int voteCount,
      String lastStatus,
      Instant lastVoteAt,
      String lastError
  ) {
    Listener withPoll(String status, String error) {
      return new Listener(userId, regionId, regionType, lastTrackId, lastTrackName, Instant.now(), pollCount + 1, voteCount, status, lastVoteAt, error);
    }

    Listener withStatus(String status, String error) {
      return new Listener(userId, regionId, regionType, lastTrackId, lastTrackName, lastPolledAt, pollCount, voteCount, status, lastVoteAt, error);
    }

    Listener withTrack(String trackId, String trackName) {
      return new Listener(userId, regionId, regionType, trackId, trackName, lastPolledAt, pollCount, voteCount, lastStatus, lastVoteAt, lastError);
    }

    Listener withVote(String status) {
      return new Listener(userId, regionId, regionType, lastTrackId, lastTrackName, lastPolledAt, pollCount, voteCount + 1, status, Instant.now(), null);
    }
  }
}
