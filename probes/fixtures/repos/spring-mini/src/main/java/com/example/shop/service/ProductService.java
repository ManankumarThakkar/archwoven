package com.example.shop.service;

import com.example.shop.repo.ProductRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class ProductService {

    private final ProductRepository productRepository;

    public ProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Autowired
    public void setOrderRepository(com.example.shop.repo.OrderRepository orderRepository) {
    }

    public String get() {
        return "product";
    }

    public String pricing() {
        return new RestTemplate().getForObject("https://pricing.example.com/quote", String.class);
    }
}
