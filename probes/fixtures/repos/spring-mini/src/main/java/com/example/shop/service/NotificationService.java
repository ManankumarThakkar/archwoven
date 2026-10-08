package com.example.shop.service;

import com.example.shop.repo.OrderRepository;
import com.example.shop.repo.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class NotificationService {

    private final OrderRepository orderRepository;
    private final ProductRepository productRepository;

    public String notify(String id) {
        return "notified " + id;
    }
}
