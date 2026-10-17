package com.example.catalog;

import org.springframework.stereotype.Service;

@Service
public class CatalogService {

    private final CatalogRepository repository;

    public CatalogService(CatalogRepository repository) {
        this.repository = repository;
    }

    public Object all() {
        return repository.findAll();
    }
}
