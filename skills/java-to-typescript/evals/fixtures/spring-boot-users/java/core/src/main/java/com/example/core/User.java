package com.example.core;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "users")
public class User {
  @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String name;

  @Column(name = "balance", precision = 19, scale = 4, nullable = false)
  private BigDecimal balance;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected User() {}

  public User(String name, BigDecimal balance) {
    this.name = name;
    this.balance = balance;
    this.createdAt = Instant.now();
  }

  public Long getId() { return id; }
  public String getName() { return name; }
  public BigDecimal getBalance() { return balance; }
  public Instant getCreatedAt() { return createdAt; }
}
