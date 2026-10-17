package com.example.catalog;

import jakarta.persistence.*;
import java.util.List;

@Entity
public class Shelf {

    @Id
    private Long id;

    @OneToMany
    @JoinColumn(name = "shelf_id")
    private List<Item> items;
}
