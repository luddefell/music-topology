package com.soundscapemap.api.config;

import com.soundscapemap.api.ws.SoundscapeWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
  private final SoundscapeWebSocketHandler handler;
  private final AppProperties properties;

  public WebSocketConfig(SoundscapeWebSocketHandler handler, AppProperties properties) {
    this.handler = handler;
    this.properties = properties;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(handler, "/ws").setAllowedOrigins(properties.publicWebOrigin());
  }
}
