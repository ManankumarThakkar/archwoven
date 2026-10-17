import httpx


class BillingService:
    def charge(self):
        return httpx.post("https://billing.example.com/charges")

    def close(self):
        pass
