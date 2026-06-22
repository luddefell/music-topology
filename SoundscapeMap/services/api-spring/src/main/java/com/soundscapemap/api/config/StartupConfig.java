package com.soundscapemap.api.config;

import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.worker.SpotifyPoller;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StartupConfig {
  @Bean
  ApplicationRunner initializeSoundscapeApi(SoundscapeRepository repository, SpotifyPoller poller, AppProperties properties) {
    return args -> {
      repository.ensureSchema();
      if (properties.enableAutoVote()) poller.start();
    };
  }
}
