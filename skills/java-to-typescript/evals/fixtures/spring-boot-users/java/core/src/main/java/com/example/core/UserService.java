package com.example.core;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.Optional;

@Service
public class UserService {
  private final UserRepository repo;

  public UserService(UserRepository repo) { this.repo = repo; }

  public Optional<User> findById(Long id) { return repo.findById(id); }

  public User create(String name, BigDecimal balance) {
    return repo.save(new User(name, balance));
  }
}
