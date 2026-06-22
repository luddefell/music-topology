package com.soundscapemap.api.ws;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class SoundscapeWebSocketHandler extends TextWebSocketHandler {
  private final RegionUpdateHub hub;
  private final ObjectMapper mapper = new ObjectMapper();

  public SoundscapeWebSocketHandler(RegionUpdateHub hub) {
    this.hub = hub;
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession session) throws Exception {
    hub.add(session);
    session.sendMessage(new TextMessage("{\"type\":\"ping\"}"));
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
    Map<String, Object> payload = mapper.readValue(message.getPayload(), new TypeReference<>() {});
    Object type = payload.get("type");
    Object cellsValue = payload.get("cells");
    if (!(cellsValue instanceof List<?> cells)) return;
    for (Object cell : cells) {
      if ("subscribe".equals(type)) hub.subscribe(session, String.valueOf(cell));
      if ("unsubscribe".equals(type)) hub.unsubscribe(session, String.valueOf(cell));
    }
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    hub.remove(session);
  }
}
