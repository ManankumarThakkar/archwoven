package com.example.catalog;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping({"/catalog", "/v2/catalog"})
public class CatalogController {

    private final CatalogService catalog;

    public CatalogController(CatalogService catalog) {
        this.catalog = catalog;
    }

    @RequestMapping(value = "/items", method = RequestMethod.GET)
    public Object items() {
        return catalog.all();
    }

    @RequestMapping(path = {"/items/{id}", "/products/{id}"}, method = {RequestMethod.PUT, RequestMethod.PATCH})
    public Object update(@PathVariable long id) {
        return catalog.all();
    }

    @GetMapping(value = "/search", produces = "application/json")
    public Object search(@RequestParam String q) {
        return catalog.all();
    }

    @PostMapping(produces = MediaType.APPLICATION_JSON_VALUE, path = "/import")
    public Object importAll() {
        return catalog.all();
    }

    @RequestMapping("/legacy")
    public Object legacy() {
        return catalog.all();
    }

    @DeleteMapping
    public void clear() {
    }
}
