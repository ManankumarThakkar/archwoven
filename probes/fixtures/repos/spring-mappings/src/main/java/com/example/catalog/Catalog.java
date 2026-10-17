package com.example.catalog;

import jakarta.persistence.*;
import java.util.List;
import java.util.Set;

@Entity
public class Catalog {

    @Id
    private Long id;

    @ManyToMany
    @JoinTable(name = "catalog_tags")
    private Set<Tag> tags;

    // Inverse side of Item.catalog: the owning @ManyToOne already describes this relation.
    @OneToMany(mappedBy = "catalog")
    private List<Item> items;
}
