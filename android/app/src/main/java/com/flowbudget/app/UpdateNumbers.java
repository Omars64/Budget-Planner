package com.flowbudget.app;

final class UpdateNumbers {
    private UpdateNumbers() {}

    static Long positiveInteger(Object value, long maximum) {
        // Android JSON uses Integer for small numbers and Long for larger ones.
        if (!(value instanceof Integer) && !(value instanceof Long)) return null;
        long number = ((Number) value).longValue();
        return number > 0 && number <= maximum ? number : null;
    }
}
