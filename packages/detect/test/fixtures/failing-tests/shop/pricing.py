def discounted(price, percent):
    """Price after a percentage discount. Seeded bug: subtracts the percent as an amount."""
    return price - percent


def with_tax(price, rate):
    return round(price * (1 + rate), 2)
