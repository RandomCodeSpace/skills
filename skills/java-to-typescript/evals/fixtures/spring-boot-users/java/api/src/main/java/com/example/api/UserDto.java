package com.example.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;

public record UserDto(Long id, String name, BigDecimal balance, Instant createdAt) {

  public record CreateRequest(
      @NotBlank String name,
      @NotNull BigDecimal balance
  ) {}
}
