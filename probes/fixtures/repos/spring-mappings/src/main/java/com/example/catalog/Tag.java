package com.example.catalog;

import jakarta.persistence.*;
import java.util.Set;

@Entity
public class Tag {

    @Id
    private Long id;

    @ManyToMany(mappedBy = "tags")
    private Set<Catalog> catalogs;
}
