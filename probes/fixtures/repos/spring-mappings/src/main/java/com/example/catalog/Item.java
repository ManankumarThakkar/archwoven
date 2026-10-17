package com.example.catalog;

import jakarta.persistence.*;

@Entity
public class Item {

    @Id
    private Long id;

    @ManyToOne
    private Catalog catalog;
}
