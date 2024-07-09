Task:
You must return the following fields in your response in two lines, one below the other:

score: Your numerical score for the model's Faitfullness Metric based on the rubric
justification: Your reasoning about the model's Faitfullness Metric score

You are an impartial judge. You will be given an input that was sent to a machine
learning model, and you will be given an output that the model produced. You
may also be given additional information that was used by the model to generate the output.

Your task is to determine a numerical score called Faitfullness Metric based on the input and output.
A definition of Faitfullness Metric and a grading rubric are provided below.
You must use the grading rubric to determine your score. You must also justify your score.

Examples could be included below for reference. Make sure to use them as references and to
understand them before completing the task.

Input:
The input to the model

Output:
The output from the model


context: 
The context used by the model


Metric definition:

Faithfulness is only evaluated with the provided output and provided context, please 
ignore the provided input entirely when scoring faithfulness. Faithfulness assesses 
how much of the provided output is factually consistent with the provided context. A 
higher score indicates that a higher proportion of claims present in the output can be 
derived from the provided context. Faithfulness does not consider how much extra 
information from the context is not present in the output.



Grading rubric:

Faithfulness: Below are the details for different scores:
- Score 1: None of the claims in the output can be inferred from the provided context.
- Score 2: Some of the claims in the output can be inferred from the provided context, but the majority of the output is missing from, inconsistent with, or contradictory to the provided context.
- Score 3: Half or more of the claims in the output can be inferred from the provided context.
- Score 4: Most of the claims in the output can be inferred from the provided context, with very little information that is not directly supported by the provided context.
- Score 5: All of the claims in the output are directly supported by the provided context, demonstrating high faithfulness to the provided context.



Example 1:
Input: How is MLflow related to Databricks?
Output: Databricks is a company that specializes in big data and machine learning
        solutions. MLflow has nothing to do with Databricks. MLflow is an open-source platform
        for managing the end-to-end machine learning (ML) lifecycle.
score: 2
justification: The output claims that "MLflow has nothing to do with Databricks" which is
        contradictory to the provided context that states "It was developed by Databricks". This
        is a major inconsistency. However, the output correctly identifies that "MLflow is an
        open-source platform for managing the end-to-end machine learning (ML) lifecycle" and
        "Databricks is a company that specializes in big data and machine learning solutions", 
        which are both supported by the context. Therefore, some of the claims in the output can
        be inferred from the provided context, but the majority of the output is inconsistent
        with the provided context, leading to a faithfulness score of 2.


Example 2:
Input: How is MLflow related to Databricks?
Output: Databricks is a company that specializes in big data and machine learning
        solutions.
score: 5
justification: The output states that "Databricks is a company that specializes in big data
         and machine learning solutions." This claim is directly supported by the context, whicc
         states "It was developed by Databricks, a company that specializes in big data and
         machine learning solutions." Therefore, the faithfulness score is 5 as all the claims in
         the output are directly supported by the provided context.





You must return the following fields in your response in two lines, one below the other:
score: Your numerical score for the model's Faitfullness Metric based on the rubric
justification: Your reasoning about the model's Faitfullness Metric score

Do not add additional new lines. Do not add any other fields.