package com.soundscapemap.api.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.soundscapemap.api.model.RegionSnapshot;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RegionUpdateHub {
  private final ObjectMapper mapper = new ObjectMapper();
  private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
  private final Map<String, Set<WebSocketSession>> subscriptions = new ConcurrentHashMap<>();

  void add(WebSocketSession session) {
    sessions.add(session);
  }

  void remove(WebSocketSession session) {
    sessions.remove(session);
    subscriptions.values().forEach(set -> set.remove(session));
  }

  void subscribe(WebSocketSession session, String regionId) {
    subscriptions.computeIfAbsent(regionId, ignored -> ConcurrentHashMap.newKeySet()).add(session);
  }

  void unsubscribe(WebSocketSession session, String regionId) {
    Set<WebSocketSession> set = subscriptions.get(regionId);
    if (set != null) set.remove(session);
  }

  public void publish(RegionSnapshot snapshot) {
    Set<WebSocketSession> targets = subscriptions.getOrDefault(snapshot.region_id(), sessions);
    String payload;
    try {
      payload = mapper.writeValueAsString(Map.of(
          "type", "region_update",
          "region_id", snapshot.region_id(),
          "h3_cell", snapshot.h3_cell(),
          "snapshot", snapshot
      ));
    } catch (IOException error) {
      throw new IllegalStateException("Could not serialize region update", error);
    }
    targets.forEach(session -> send(session, payload));
  }

  private void send(WebSocketSession session, String payload) {
    if (!session.isOpen()) return;
    try {
      session.sendMessage(new TextMessage(payload));
    } catch (IOException ignored) {
      remove(session);
    }
  }
}
