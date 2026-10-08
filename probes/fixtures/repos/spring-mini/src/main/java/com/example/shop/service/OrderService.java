package com.example.shop.service;

import com.example.shop.repo.OrderRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public String list() {
        return orderRepository.findAll();
    }

    public String create(String body) {
        return orderRepository.save(body);
    }

    @KafkaListener(topics = "orders.events")
    public void onOrderEvent(String event) {
        System.out.println(event);
    }
}
