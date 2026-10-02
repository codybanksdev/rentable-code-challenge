"""Sort ledger entries into accounting categories.

The PMS gives no category, only a free-text description, so this is the one
place a description is read for meaning. It decides which account an entry
belongs to. It never decides direction: that is always `type` and the sign.

A real deployment should get the category from the PMS, or from a mapping
the customer maintains. Until then the rule is kept this small on purpose.
"""
from api.models import Transaction


def categorize(description):
    if 'security deposit' in (description or '').lower():
        return Transaction.Category.DEPOSIT
    return Transaction.Category.RENT_AND_FEES
