package com.flowbudget.app;

public final class UpdateNumbersTest {
    private static int checks;

    private static void expect(Object value, long maximum, Long expected) {
        Long actual = UpdateNumbers.positiveInteger(value, maximum);
        if (!java.util.Objects.equals(actual, expected)) {
            throw new AssertionError("Incorrect number validation for " + value);
        }
        checks++;
    }

    public static void main(String[] args) {
        expect(Integer.valueOf(9374981), 268435456L, 9374981L);
        expect(Integer.valueOf(45), 2100000000L, 45L);
        expect(Long.valueOf(9374981), 268435456L, 9374981L);
        expect(Long.valueOf(2100000000L), 2100000000L, 2100000000L);
        expect(Integer.valueOf(0), 268435456L, null);
        expect(Integer.valueOf(-1), 268435456L, null);
        expect(Long.valueOf(268435457L), 268435456L, null);
        expect(Long.valueOf(2100000001L), 2100000000L, null);
        expect(Double.valueOf(45), 2100000000L, null);
        expect(Double.valueOf(45.5), 2100000000L, null);
        expect("45", 2100000000L, null);
        expect(Boolean.TRUE, 2100000000L, null);
        expect(null, 2100000000L, null);
        System.out.println(checks + " native update number checks passed.");
    }
}
