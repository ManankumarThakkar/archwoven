package com.example.shop.repo;

import org.springframework.stereotype.Repository;

@Repository
public class OrderRepository {

    public String findAll() {
        return "[]";
    }

    public String save(String body) {
        return body;
    }
}
