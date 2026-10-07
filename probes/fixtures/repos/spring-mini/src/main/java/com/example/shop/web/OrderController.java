package com.example.shop.web;

import com.example.shop.service.OrderService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrderController {

    @Autowired
    private OrderService orderService;

    @GetMapping
    public String list() {
        return orderService.list();
    }

    @PostMapping
    public String create(@RequestBody String body) {
        return orderService.create(body);
    }
}
