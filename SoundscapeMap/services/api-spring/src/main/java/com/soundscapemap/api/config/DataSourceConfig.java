package com.soundscapemap.api.config;

import java.net.URI;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Configuration
public class DataSourceConfig {
  @Bean
  DataSource dataSource(Environment environment) {
    String rawUrl = environment.getProperty("DATABASE_URL", environment.getProperty("spring.datasource.url", "jdbc:postgresql://localhost:5432/soundscape"));
    DriverManagerDataSource dataSource = new DriverManagerDataSource();
    dataSource.setDriverClassName("org.postgresql.Driver");
    if (rawUrl.startsWith("postgresql://")) {
      URI uri = URI.create(rawUrl);
      String userInfo = uri.getUserInfo();
      String[] credentials = userInfo == null ? new String[] {"", ""} : userInfo.split(":", 2);
      dataSource.setUrl("jdbc:postgresql://" + uri.getHost() + ":" + uri.getPort() + uri.getPath());
      if (credentials.length > 0) dataSource.setUsername(credentials[0]);
      if (credentials.length > 1) dataSource.setPassword(credentials[1]);
      return dataSource;
    }
    dataSource.setUrl(rawUrl);
    dataSource.setUsername(environment.getProperty("DATABASE_USERNAME", environment.getProperty("spring.datasource.username", "")));
    dataSource.setPassword(environment.getProperty("DATABASE_PASSWORD", environment.getProperty("spring.datasource.password", "")));
    return dataSource;
  }
}
