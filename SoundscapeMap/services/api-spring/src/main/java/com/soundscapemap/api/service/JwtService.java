package com.soundscapemap.api.service;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.soundscapemap.api.config.AppProperties;
import com.soundscapemap.api.model.UserSession;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final byte[] secret;

  public JwtService(AppProperties properties) {
    this.secret = properties.jwtSecret().getBytes(StandardCharsets.UTF_8);
  }

  public String issue(UserSession session) {
    try {
      Instant now = Instant.now();
      JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
          .claim("userId", session.userId())
          .claim("anonymous", session.anonymous())
          .issueTime(Date.from(now))
          .expirationTime(Date.from(now.plusSeconds(3600)));
      if (session.spotifyId() != null) claims.claim("spotifyId", session.spotifyId());
      SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims.build());
      jwt.sign(new MACSigner(secret));
      return jwt.serialize();
    } catch (Exception error) {
      throw new IllegalStateException("JWT signing failed", error);
    }
  }

  public Optional<UserSession> verify(String token) {
    try {
      SignedJWT jwt = SignedJWT.parse(token);
      if (!jwt.verify(new MACVerifier(secret))) return Optional.empty();
      JWTClaimsSet claims = jwt.getJWTClaimsSet();
      if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new Date())) return Optional.empty();
      return Optional.of(new UserSession(
          String.valueOf(claims.getClaim("userId")),
          claims.getStringClaim("spotifyId"),
          Boolean.TRUE.equals(claims.getBooleanClaim("anonymous"))
      ));
    } catch (Exception error) {
      return Optional.empty();
    }
  }

  public Optional<UserSession> fromAuthorization(String authorization) {
    if (authorization == null || !authorization.toLowerCase().startsWith("bearer ")) return Optional.empty();
    return verify(authorization.substring(7).trim());
  }
}
