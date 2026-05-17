package com.example.api;

import com.example.core.UserService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/users")
public class UserController {
  private final UserService svc;

  public UserController(UserService svc) { this.svc = svc; }

  @GetMapping("/{id}")
  public ResponseEntity<UserDto> getById(@PathVariable Long id) {
    return svc.findById(id)
        .map(u -> ResponseEntity.ok(new UserDto(u.getId(), u.getName(), u.getBalance(), u.getCreatedAt())))
        .orElse(ResponseEntity.notFound().build());
  }

  @PostMapping
  public ResponseEntity<UserDto> create(@Valid @RequestBody UserDto.CreateRequest req) {
    var u = svc.create(req.name(), req.balance());
    return ResponseEntity.status(201).body(new UserDto(u.getId(), u.getName(), u.getBalance(), u.getCreatedAt()));
  }
}
