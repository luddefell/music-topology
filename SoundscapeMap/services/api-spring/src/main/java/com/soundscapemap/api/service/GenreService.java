package com.soundscapemap.api.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
public class GenreService {
  private static final double HALF_LIFE_MINUTES = 45.0;
  private static final String FALLBACK = "unknown";
  private static final Map<String, Pattern> RULES = Map.ofEntries(
      Map.entry("hiphop", Pattern.compile("\\b(hip.?hop|rap|trap|drill|grime|phonk|melodic rap|conscious rap|cloud rap|emo rap)\\b")),
      Map.entry("electronic", Pattern.compile("\\b(electr|house|techno|edm|dance|dubstep|ambient|trance|garage|dnb|drum and bass|hyperpop|escape room|future bass)\\b")),
      Map.entry("rock", Pattern.compile("\\b(rock|punk|grunge|shoegaze|permanent wave|modern rock|alternative rock|indie rock|post-punk|new wave|emo)\\b")),
      Map.entry("jazz", Pattern.compile("\\b(jazz|bebop|swing|fusion|hard bop|big band|ragtime)\\b")),
      Map.entry("classical", Pattern.compile("\\b(classical|orchestra|orchestral|baroque|opera|symphony|chamber|choral|concerto|sonata)\\b")),
      Map.entry("latin", Pattern.compile("\\b(latin|reggaeton|salsa|bachata|bossa|cumbia|mambo|merengue|latin trap|urbano latino|regional mexican)\\b")),
      Map.entry("country", Pattern.compile("\\b(country|bluegrass|americana|honky|western|outlaw country|nashville)\\b")),
      Map.entry("rnb", Pattern.compile("\\b(r.?b|r and b|soul|funk|neo soul|trap soul|alternative r.?b|urban contemporary|motown)\\b")),
      Map.entry("folk", Pattern.compile("\\b(folk|indie folk|singer.songwriter|singer-songwriter|acoustic|bedroom pop|indie pop|dream pop|lo-fi indie)\\b")),
      Map.entry("metal", Pattern.compile("\\b(metal|hardcore|doom|black metal|death metal|metalcore|deathcore|thrash|sludge)\\b")),
      Map.entry("world", Pattern.compile("\\b(afro|afrobeats|world|k.?pop|j.?pop|bollywood|bhangra|highlife|samba|dancehall|reggae|amapiano)\\b")),
      Map.entry("pop", Pattern.compile("\\b(pop|chart|boy band|girl group|dance pop|pop rap|synthpop|teen pop|viral pop)\\b"))
  );

  public String classify(List<String> genres) {
    Map<String, Double> scores = new HashMap<>();
    RULES.keySet().forEach(genre -> scores.put(genre, 0.0));
    for (String raw : genres) {
      String text = String.valueOf(raw).toLowerCase();
      for (Map.Entry<String, Pattern> entry : RULES.entrySet()) {
        if (entry.getValue().matcher(text).find()) {
          scores.merge(entry.getKey(), entry.getKey().equals("pop") ? 0.72 : 1.0, Double::sum);
        }
      }
    }
    return scores.entrySet().stream()
        .max(Comparator.comparingDouble(Map.Entry::getValue))
        .filter(entry -> entry.getValue() > 0)
        .map(Map.Entry::getKey)
        .orElse(FALLBACK);
  }

  public double computeWeight(Instant votedAt, Instant now, double baseWeight) {
    double minutes = Math.max(0, (now.toEpochMilli() - votedAt.toEpochMilli()) / 60000.0);
    return baseWeight * Math.pow(0.5, minutes / HALF_LIFE_MINUTES);
  }

  public String dominantGenre(Map<String, Double> scores) {
    return scores.entrySet().stream()
        .filter(entry -> Double.isFinite(entry.getValue()) && entry.getValue() > 0)
        .max(Comparator.comparingDouble(Map.Entry::getValue))
        .map(Map.Entry::getKey)
        .orElse(FALLBACK);
  }
}
