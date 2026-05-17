package com.example.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.context.annotation.ComponentScan;

@SpringBootApplication
@ComponentScan(basePackages = {"com.example.api", "com.example.core"})
@EntityScan(basePackages = "com.example.core")
@EnableJpaRepositories(basePackages = "com.example.core")
public class UsersApplication {
  public static void main(String[] args) {
    SpringApplication.run(UsersApplication.class, args);
  }
}
